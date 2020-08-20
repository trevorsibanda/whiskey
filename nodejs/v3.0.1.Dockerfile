FROM openwhisk/action-nodejs-v10:latest

WORKDIR /nodejsAction
RUN npm install --save faunadb@3.0.1

CMD node --expose-gc app.js
