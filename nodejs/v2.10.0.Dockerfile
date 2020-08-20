FROM openwhisk/action-nodejs-v10

WORKDIR /nodejsAction
RUN npm install --save faunadb@2.10.0

CMD node --expose-gc app.js
