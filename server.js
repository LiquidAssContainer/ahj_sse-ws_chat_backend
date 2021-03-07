const http = require('http');
const path = require('path');
const Koa = require('koa');
const koaBody = require('koa-body');
const uuid = require('uuid');
const serve = require('koa-static');
const Router = require('koa-router');
const WS = require('ws');

const initCors = require('./cors');

const app = new Koa();
const router = new Router();

const publicDirPath = path.join(__dirname, '/public');

app.use(initCors);
app.use(
  koaBody({
    text: true,
    urlencoded: true,
    multipart: true,
    json: true,
  })
);

app.use(router.routes()).use(router.allowedMethods());
app.use(serve(publicDirPath));

const port = process.env.PORT || 7070;
const server = http.createServer(app.callback());

const wsServer = new WS.Server({ server });

const users = [];
// задел на хранение прошлых сообщений
const messages = [];

const errCallback = (err) => {
  if (err) {
    ws.send(createMsg('error', 'Какая-то ошибка'), errCallback);
  }
};

wsServer.on('connection', (ws) => {
  // наверное, лучше бы не циклом, а одним массивом отправлять и отдельно обрабатывать
  for (const user of users) {
    ws.send(createMsg('userCame', user.username), errCallback);
  }

  for (const msg of messages) {
    ws.send(createMsg('message', msg), errCallback);
  }

  ws.on('message', (json) => {
    let msg;
    try {
      msg = JSON.parse(json);
    } catch (e) {
      ws.send(createMsg('error', 'Вы отправили некорректный JSON'), errCallback);
      return;
    }
    switch (msg.type) {
      case 'newUser':
        newUserHandler(msg.data, ws);
        break;
      case 'message':
        messageHandler(msg, ws);
    }
  });

  ws.on('close', () => {
    const index = users.findIndex((elem) => elem.ws === ws);
    if (index !== -1) {
      const { username } = users[index];
      users.splice(index, 1);
      sendToAll(createMsg('userGone', username));
    }
  });
});

function messageHandler(msg, ws) {
  const { data, userId } = msg;
  if (typeof data !== 'string') {
    ws.send(createMsg('error', 'Сообщение должно быть строкой'), errCallback);
    return;
  }
  if (/^\s*$/.test(data)) {
    ws.send(createMsg('error', 'Сообщение должно быть не пустое'), errCallback);
    return;
  }

  const user = users.find((elem) => elem.id === userId);
  if (user) {
    const { data } = msg;
    const { username } = user;
    const messageData = {
      username: username,
      message: data,
      // задел на идентификацию последнего пришедшего сообщения
      messageId: uuid.v4(),
      date: new Date(),
    };
    messages.push(messageData);
    sendToAll(createMsg('message', messageData));
  }
}

function newUserHandler(data, ws) {
  if (typeof data !== 'string') {
    ws.send(createMsg('usernameError', 'Username должен быть строкой!'), errCallback);
    return;
  }
  if (/^\s*$/.test(data)) {
    ws.send(createMsg('usernameError', 'У вас username пустой!'), errCallback);
    return;
  }
  if (users.find((user) => user.username === data)) {
    ws.send(createMsg('usernameError', 'Пользователь с таким именем уже есть!'), errCallback);
    return;
  }

  const username = data;
  // id был заделом на примитивную идентификацию юзера, пусть будет
  const id = uuid.v4();
  const userData = { username, ws, id };

  users.push(userData);
  ws.send(createMsg('userId', { username, id }));
  sendToAll(createMsg('userCame', username));
}

function createMsg(type, data) {
  const msg = { type, data };
  return JSON.stringify(msg);
}

function sendToAll(msg) {
  [...wsServer.clients].filter((o) => o.readyState === WS.OPEN).forEach((o) => o.send(msg));
}

server.listen(port);
