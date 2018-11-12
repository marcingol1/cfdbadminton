import { gql } from "apollo-server";

const schema = gql`
enum GameType {
    Deathmatch
    CaptureTheFlag
    Arena
  }
  type Player {
    id: ID
    online: Boolean
    gamesHistory: [Match]
  }
  type Match {
    score: Float
    gameType: GameType,
    players: [Player]
  }
  enum Region {
    Europe
    Asia
    NorthAmerica
    SouthAmerica
  }
  type Server {
    id: String
    title: String
    playersOnline: Int
    region: Region
    match: Match
  }

  type Query {
    servers: [Server]
  }
`;

export default schema;