function hello(event, context, callback) {
  const response = {
    statusCode: 200,
    body: JSON.stringify({
      message: 'hello world!',
      input: event,
    }),
  };

  callback(null, response);
}

export default hello;
