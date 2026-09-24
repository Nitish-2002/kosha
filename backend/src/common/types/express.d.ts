import { RequestUser } from '../../auth/jwt-payload.interface';

// Passport declares a global, empty Express.User interface specifically for
// other code to extend via declaration merging — augmenting it (rather than
// redeclaring Request.user directly) is what makes req.user typed everywhere,
// including inside PassportStrategy's own typings.
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- this is the merge, not a redundant alias
    interface User extends RequestUser {}
  }
}
