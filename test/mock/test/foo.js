export default (req, res) => {
  res.send(String(Date.now()) + Math.random())
}
