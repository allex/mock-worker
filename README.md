serve-middleware
---

A serve middleware with localize api mock and multi proxies

## Features

* Easy integrate and light api scheme definitions.
* Dynamic params routes and custom programming ability. eg,. `/api/foo/:id`
* Built-in `typescript` types support. ([ts-node](https://www.npmjs.com/package/ts-node) manuall install required)
* Auto reload and register mock routes. (w/o restart server when mock files changed)
* Pure json or any text based api mock. (optional supports [mockjs][3] extenssion)
* [http-proxy-middleware][1] proxy is integrated. `.proxy.json`, `.proxy.js`

## Install

```sh
$ yarn add serve-middleware
```

## APIs

```js
import { middleware } from 'serve-middleware'
import express from 'express'

const app = express()

app.use(
  middleware({
    prefix: '/',
    root: './mock'
  })
)
```

### Options

* root: The serve routes root directorty, need a absolute path.
* prefix: a baseurl for the server entry. eg: `/api`

create `.proxy.json` in project’s root: (json config support env vars expand)

```json
{
  "^/(api|image_pic_path)/": {
    "target": "${API_PREFIX:-http://127.0.0.1:30006}",
    "changeOrigin": true,
    "pathRewrite": {
      "^/api/": ""
    }
  },
  "^/jaeger-ui": {
    "target": "${JAEGER_UI_BASE:-http://127.0.0.1:3001}",
    "changeOrigin": true,
    "logLevel": "${PROXY_LOG_LEVEL:-info}"
  }
}
```

## Usage

For details example, see [examples](https://github.com/allex/serve-middleware/test/mock/) 

## License

[MIT](http://opensource.org/licenses/MIT) Copyright (c) [Allex Wang][2]

[1]: https://github.com/chimurai/http-proxy-middleware
[2]: https://github.com/allex/
[3]: https://www.npmjs.com/package/mockjs
