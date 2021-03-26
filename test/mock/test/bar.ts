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
  'PUT /user': {
    id: 2,
    username: 'kenny',
    sex: 6
  }
}

export default userApis
