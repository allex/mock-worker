mock-worker
---

## Features

* Easy integrate and light api scheme definitions.
* Dynamic params routes and custom programming ability. eg,. `/api/foo/:id`
* Built-in `typescript` types support. ([ts-node](https://www.npmjs.com/package/ts-node) manuall install required)
* Auto reload and register mock routes. (w/o restart server when mock files changed)
* Pure json or any text based api mock. (optional supports [mockjs](https://www.npmjs.com/package/mockjs) extenssion)


## Install

```sh
$ yarn add mock-worker
```


## Usage

Create test mock api server (or integrate as webpack server middleware) 
For more details example, see [./test/](https://github.com/allex/mock-worker/test/mock/) 

> Create a mock server

```sh
$ cat <<EOF > server.js
const app = require('express')()

app.get('/', (req, res) => { 
  res.send('Hello World') 
})

app.use(require('mock-worker').middleware({
  prefix: '/',
  root: './mock'
}))

console.log('start test server at 3001...')
app.listen(3001)
EOF
```

> Add some example mocks

params routes example:

```sh
$ mkdir -p ./mock && cat <<EOF > ./mock/user.ts
type User = {
  id: number;
  username: string;
  sex: number;
}

type ApiScheme<T> = {
  [api: string]: T | ((req, res, next?) => T | void);
}

const userApis: ApiScheme<User> = {
  'GET /user/:id': (req, res) => {
    console.log({ url: req.url, params: req.params, query: req.query })
    return {
      id: req.params.id,
      username: 'allex',
      sex: 6
    }
  },
  'PUT /user': {
    id: 2,
    username: 'kenny',
    sex: 6
  }
}

export default userApis
EOF
```

pure api example:

```sh
$ mkdir -p ./mock && cat <<EOF > ./mock/foo.ts
export default (req, res) => {
  res.send(String(Date.now()) + Math.random())
}
EOF
```

> Start server

```sh
$ export DEBUG=mock-* && node server.js
```

> Enjoy it!

```sh
curl -X GET http://localhost/foo
curl -X GET http://localhost/users/1
curl -X PUT http://localhost/users
```

## License

[MIT](http://opensource.org/licenses/MIT) Copyright (c) [Allex Wang][1]

[1]: https://github.com/allex/
