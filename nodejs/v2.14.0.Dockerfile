FROM openwhisk/action-nodejs-v10:latest

WORKDIR /nodejsAction
RUN npm install --save faunadb@2.14.0

CMD node --expose-gc app.js
