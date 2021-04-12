const p = require('path')
const app = require('express')()

console.log('start test server at 3001...')

// require('@babel/register')

app.get('/', function (req, res) {
  res.send('Hello World')
})

app.use(require('../').middleware({
  logLevel: 'debug',
  prefix: '/api/',
  root: p.resolve(__dirname, './mock')
}))

app.listen(3001)
