const p = require('path')
const app = require('express')()

// require('@babel/register')

app.get('/', function (req, res) {
  res.send('Hello World')
})

app.use(require('../').middleware({
  prefix: '/mock',
  root: p.resolve(__dirname, './mock')
}))

console.log('start test server at 3001...')
app.listen(3001)
