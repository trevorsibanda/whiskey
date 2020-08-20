var fetch = require("node-fetch");
var faunadb = require("faunadb")
const q = faunadb.query

var promiseRetry = require('promise-retry');

var Pusher = require('pusher');
var PusherC = require("pusher-js");
var openwhisk = require('openwhisk');

const express = require('express')
const bodyParser = require('body-parser');

//
var pushs = new Pusher({
    appId: '1053366',
    key: '88b8c8330e7d22fcec60',
    secret: 'd69dba46e43fb5ebde23',
    cluster: 'us2',
    useTLS: true
});

let pushc = new PusherC('88b8c8330e7d22fcec60',
    {cluster: 'us2'});

let client = new faunadb.Client({
    secret: "fnADzrmp3pACBuEpd9pOuIaIsNraY-B8EDiF6_T1",
    domain: "db.fauna.com",
    port: "443",
    scheme: "https"
})

var options = {
    apihost: 'https://172.17.0.1:3233',
    api_key: '23bc46b1-71f6-4ed5-8c54-816aa4f8c502:123zO3xZCLrMN6v2BKK1dXYFpXlPkccOFqm12CdAsMgRU4VrNZ9lyGVCGuMDGIwP',
    ignore_certs: true};
var ow = openwhisk(options);

function prepareCode(exec) {
    return `function main(args) {
    let name = args.name || 'stranger'
    let greeting = 'Hello ' + name + '!'
    console.log(greeting)
    ${exec.code}
    return {"body":  greeting}
}`
}

//retrieve code snippet from database and pass code to openw
function createAction(client, exec) {
    let overwrite = true
    let kind = 'nodejs:default'
    return ow.actions.create({
        name: exec._id,
        namespace: "_",
        action: prepareCode(exec),
        kind: kind,
        overwrite: overwrite}).then(activationId => {
        console.log('created activation id ', activationId)
        return activationId
    }).catch(err => {
        console.error('Failed to create action ', exec, ' with error ', err)
    })
}

//deletes the action and frees up any acquired resources(faunafb_instance..etc)
async function actionTeardown(exec){
    let name = exec.data._id
    return ow.actions.delete({actionName: name, name: name}).then(_ => {
        let query = q.Let({
            'snippet': q.Get(exec.ref)
        }, q.Let({
            'keyRef': q.Select(['data', 'activation', 'faunaInstance', 'key'], q.Var('snippet')),
            'dbRef' : q.Select(['data', 'activation', 'faunaInstance', 'database'], q.Var('snippet'))
        }, q.Do(
            q.Delete(q.Var('keyRef')),
            q.Delete(q.Var('dbRef'))
        )))
        return client.query(query).catch(err => {
            console.error('Failed to free up faunaInstance for ', exec, ' with error ', err)
        })
    })
}

//create an activation
async function runActivation(exec) {
    let name = exec._id
    let blocking = true
    let result = false
    let params = prepareArgs(exec)
    return ow.actions.invoke({ name, blocking, result, params })
}

//pushes action results to browser
//chunks data into 1000byte messages and sends them
function pushResults(exec, chan, resp) {
    return promiseRetry((retry, number) => {
        console.log('retry ', number)
        return ow.activations.logs(resp.activationId)
            .then(l => {
                let count = 0
                let buffer = []
                let msgCount = 0
                for (let i = 0; i < l.logs.length; i++) {
                    const line = l.logs[i];

                    if((count+line.length) > 1000) {
                        pushs.trigger(chan, 'result', buffer.join("\r\n"))
                        msgCount += 1
                        if(msgCount > 5){
                            break; //max 1024*5bytes
                        }
                        buffer = []
                        count = 0
                    } else {
                        count += line.length
                        buffer.push(line)
                    }
                }
                if (buffer.length > 0 ) {
                    pushs.trigger(chan, 'result', buffer.join("\r\n"))
                }
            })
            .catch(function (err) {
                if (err.statusCode === 404) {
                    retry(err);
                }

                throw err;
            });
    }, {retries: 5, minTimeout: 1500})
}

function delay(t, v) {
    return new Promise(function (resolve) {
        setTimeout(resolve.bind(null, v), t)
    });
}

//prepare execution by setting image 
function updateExecution(client, ref, documentMerge) {
    return client.query(q.Update(ref, {data: documentMerge})).catch(err =>
        console.error('Failed to update execution ', ref, ' with error ', err)
    )
}

//retrieve execution given id
function retrieveExecution(client, _id) {
    return client.query(q.Get(q.Match(q.Index('executionById'), _id))).catch(err => {
        console.error('Failed to retrieve execution ',_id, ' with error ', err)
    })
}

function dbName(exec) {
    return `${exec._id}DB`
}

//Passes args to fauna instance
function prepareArgs(exec) {
    let inst = exec.activation.faunaInstance
    return {
        activation_id: exec._id,
        faunaOpts: {
            host: inst.host,
            port: inst.port,
            scheme: inst.scheme,
            secret: inst.keySecret
        }
    }
}

//prepares the schema for an activation
function prepareSchema(client, chan, data){
    let ref = data.ref
    let exec = data.data
    pushs.trigger(chan, 'status', 'faunadbschema')
    let createdb = q.CreateDatabase({
        name: dbName(exec)
    })
    return client.query(createdb).then(db => {
        console.log(db)
        let createkey = q.CreateKey({
            name: `${exec._id}AdminKey`,
            role: 'admin',
            database: db.ref
        })
        return client.query(createkey).then(key => {
            console.log(key)
            let inst = {
                host: '172.43.18.3',
                port: 8443,
                secret: key.secret,
                database: db.ref,
                key: key.ref,
                keySecret: key.secret,
                logs: []
            }
            return updateExecution(client, ref, {
                activation: {
                    faunaInstance: inst
                }
            })
        })
    }).catch(console.error)
}

//binds to a channel and handles all incoming requests
async function handler(_id, chan) {
    let exec = await retrieveExecution(client, _id).catch(err => {
        console.error('Failed to retrieve execution!', _id, ' with error ', err)
        pushs.trigger(chan, 'fatal', 'Internal error. Failed to retrieve execution')
    })
    pushs.trigger(chan, 'status', 'faunadbinit')
    return prepareSchema(client, chan, exec).then(updatedExec => {
        exec = updatedExec
        pushs.trigger(chan, 'status', 'faunadbready')
        return createAction(client, exec.data).then(_ =>{
            pushs.trigger(chan, 'status', 'execstarted')
            return runActivation(exec.data).then(resp => {
                return pushResults(exec, chan, resp).then(_ => 
                    actionTeardown(exec).then(_ => {
                        pushs.trigger(chan, 'status', 'teardown')
                    })
                )
            }).catch(err => {
                console.error('Failed to run activation ', exec.data._id, ' with error ', err )
                pushs.trigger(chan, 'fatal', 'Failed to execute code. \r\n' + JSON.stringify(err))
                actionTeardown(exec)
            })
        }).catch(err => {
            console.error('Failed to create new action ', _id , ' with error ', err)
            pushs.trigger(chan, 'fatal', 'Internal error, runner pool not available')
        })
    }).catch(err => {
        actionTeardown(exec)
        console.error('Failed to setup faunadb instance for ', _id, ' with error ', err)
        pushs.trigger(chan, 'fatal', 'Internal error, faunadb instance setup failed.')
    })
}


let newExecs = pushc.subscribe('new_activations')
newExecs.bind('add', data => {
    console.log('new activation to execution ', JSON.stringify(data))
    handler(data._id, data.channel)
})

const app = express()

app.use(bodyParser.urlencoded({ extended: true }));

app.post('/_/v1/execution/start', (req, res) => {
    let body = req.body
    console.log('Got ', body)
    //start the handler 
    res.json({status: 'ok'})
    handler(body._id, body.channel)
})


app.use('/_/v1/execution/terminate', (req, res) => {
    console.log('terminate it!')
})
//let opts = { "channel": "e7fbdb026d18b01", "_id": "e7fbdb026d18b015a44799ea62dba3cb05c744ca" }
//handler(opts._id, opts.channel)

app.listen(8900, () => console.log('Listening...'))
