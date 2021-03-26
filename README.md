mock-worker
---

yarn add mock-worker

## Usage

> create test mock api, eg: ./mock/user.ts
> for more details example, see `[./test/](./test)`

```sh
mkdir ./mock && cat <<EOF > ./mock/user.ts
type User = {
  id: number;
  username: string;
  sex: number;
}

type ApiScheme<T> = {
  [api: string]: T | ((req, res, next?) => T | void);
}

const userApis: ApiScheme<User> = {
  'GET /api/user/:id': (req, res) => {
    console.log({
      url: req.url,
      params: req.params,
      query: req.query
    })
    return {
      id: req.params.id,
      username: 'allex',
      sex: 6
    }
  },
  'PUT /api/user': {
    id: 2,
    username: 'kenny',
    sex: 6
  }
}

export default userApis
EOF
```
> create a test server

```sh
cat <<EOF > server.js
const app = require('express')()

// require('@babel/register')

app.get('/', function (req, res) {
  res.send('Hello World')
})

app.use(require('mock-worker').middleware({
  baseUrl: '/',
  rootDir: './mock'
}))

console.log('start a test server at 3000...')
app.listen(3001)
EOF
```

## License

[MIT](http://opensource.org/licenses/MIT) Copyright (c) [Allex Wang][1]

[1]: https://github.com/allex/
