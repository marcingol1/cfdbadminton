import express from 'express';
import path from 'path';
import cors from 'cors';
import { ApolloServer, gql } from 'apollo-server-express';

// Construct a schema, using GraphQL schema language
const typeDefs = gql`
  type Query {
    hello: String
  }
`;

// Provide resolver functions for your schema fields
const resolvers = {
  Query: {
    hello: () => 'Hello world'
  }
};

const buildPath = '../build';
const server = new ApolloServer({ typeDefs, resolvers });

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, buildPath)));

app.get('/ping', function (req, res) {
  return res.send(JSON.stringify('pong'));
 });

 app.get('/', function (req, res) {
   res.sendFile(path.join(__dirname, buildPath, 'index.html'));
 });

server.applyMiddleware({ app });

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`🚀 GraphQL endpoint ready at http://localhost:8080${server.graphqlPath}`);
  console.log('🚀 Default API endpoint hosted at http://localhost:3000');
});
