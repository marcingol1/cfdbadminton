import { Query } from './Query';
import { Subscription } from './Subscription';
import { auth } from './Mutation/auth';
import { post } from './Mutation/post';
import { AuthPayload } from './AuthPayload';
import { user } from './Mutation/user';

export default {
  Query,
  Mutation: {
    ...auth,
    ...post,
    ...user,
  },
  Subscription,
  AuthPayload,
};
