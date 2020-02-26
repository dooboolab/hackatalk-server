import {
  AuthPayload,
  Notification,
  Resolvers,
  SocialUserInput,
  User,
} from '../generated/graphql';
import {
  ErrorEmailForUserExists,
  ErrorEmailNotValid,
  ErrorEmailSentFailed,
  ErrorPasswordIncorrect,
  ErrorUserNotExists,
  ErrorUserNotSignedIn,
} from '../utils/error';
import {
  Role,
  checkAuth,
  encryptCredential,
  getEmailVerificationHTML,
  getPasswordResetHTML,
  validateCredential,
  validateEmail,
} from '../utils/auth';

import { AuthType } from '../models/User';
import { ModelType } from '../models';
import { Op } from 'sequelize';
import SendGridMail from '@sendgrid/mail';
import createOrGetVirgilJwtGenerator from '../utils/virgil';
import jwt from 'jsonwebtoken';
import { withFilter } from 'apollo-server';

const USER_SIGNED_IN = 'USER_SIGNED_IN';
const USER_UPDATED = 'USER_UPDATED';

const signInWithSocialAccount = async (
  socialUser: SocialUserInput,
  models: ModelType,
  appSecret: string,
): Promise<AuthPayload> => {
  const { User: userModel } = models;

  if (socialUser.email) {
    const emailUser = await userModel.findOne({
      where: {
        email: socialUser.email,
        socialId: { [Op.ne]: socialUser.socialId },
      },
      raw: true,
    });

    if (emailUser) {
      throw ErrorEmailForUserExists();
    }
  }

  const user = await userModel.findOrCreate({
    where: { socialId: `${socialUser.socialId}` },
    defaults: {
      socialId: socialUser.socialId,
      authType: socialUser.authType,
      email: socialUser.email,
      nickname: socialUser.name,
      name: socialUser.name,
      birthday: socialUser.birthday,
      gender: socialUser.gender,
      phone: socialUser.phone,
      verified: true,
    },
  });

  if (!user || (user && user[1] === false)) {
    // user already exists
  }

  const token: string = jwt.sign(
    {
      userId: user[0].id,
      role: Role.User,
    },
    appSecret,
  );

  return {
    token,
    user: user[0],
  };
};

const resolver: Resolvers = {
  Query: {
    me: async (_, args, { getUser }): Promise<User> => {
      const auth = await getUser();
      return auth;
    },
    users: async (_, args, { verifyUser, models }): Promise<User[]> => {
      const { User: userModel } = models;
      const auth = verifyUser();
      checkAuth(auth);

      const { user, includeUser, filter, first, after } = args;

      let query: object = {};
      if (after) {
        query = {
          id: { [Op.gt]: after },
        };
      }

      let limit: number;
      if (first) {
        limit = first;
      }

      if (includeUser === false) {
        return userModel.findAll({
          where: {
            ...user,
            ...query,
            id: {
              [Op.ne]: auth.userId,
            },
            verified: true,
          },
          limit,
          order: [
            ['id', 'ASC'],
          ],
        });
      }

      if (filter && user) {
        return userModel.findAll({
          where: {
            ...query,
            [Op.or]: {
              nickname: { [Op.like]: user.nickname },
              email: { [Op.like]: user.email },
              name: { [Op.like]: user.name },
            },
            limit,
            verified: true,
          },
          order: [
            ['id', 'ASC'],
          ],
        });
      }

      return userModel.findAll({
        where: {
          ...user,
          ...query,
          verified: true,
        },
        limit,
        order: [
          ['id', 'ASC'],
        ],
      });
    },
    user: (_, args, { models }): Promise<User> => {
      const { User } = models;

      return User.findOne({ where: args });
    },
  },
  Mutation: {
    signInEmail: async (_, args, { models, appSecret, pubsub }): Promise<AuthPayload> => {
      const { User: userModel } = models;

      const user = await userModel.findOne({
        where: {
          email: args.email,
        },
        raw: true,
      });

      if (!user) throw ErrorUserNotExists();

      const validate = await validateCredential(args.password, user.password);

      if (!validate) throw ErrorPasswordIncorrect();

      const token: string = jwt.sign(
        {
          userId: user.id,
          role: Role.User,
        },
        appSecret,
      );

      try {
        pubsub.publish(USER_SIGNED_IN, { userSignedIn: user });
        return {
          token,
          user,
        };
      } catch (err) {
        throw new Error(err);
      }
    },

    signInWithSocialAccount: async (
      _, { socialUser },
      { appSecret, models },
    ): Promise<AuthPayload> =>
      signInWithSocialAccount(socialUser, models, appSecret),

    signUp: async (_, args, { appSecret, models }): Promise<AuthPayload> => {
      const { User: userModel } = models;
      const { email } = args.user;

      const emailUser = await userModel.findOne({
        where: { email },
        raw: true,
      });

      if (emailUser) {
        throw ErrorEmailForUserExists();
      }

      args.user.password = await encryptCredential(args.user.password);
      const user = await userModel.create(
        {
          ...args.user,
          authType: AuthType.Email,
        },
        { raw: true },
      );
      const token: string = jwt.sign(
        {
          userId: user.id,
          role: Role.User,
        },
        appSecret,
      );

      return { token, user };
    },
    sendVerification: async (_, args, { models }): Promise<boolean> => {
      const { email } = args;
      const { User: userModel } = models;

      try {
        const user = await userModel.findOne({
          where: { email },
        });

        if (user) {
          const hashedEmail = await encryptCredential(email);
          const html = getEmailVerificationHTML(email, hashedEmail);
          const msg = {
            to: email,
            from: 'noreply@hackatalk.dev',
            subject: '[HackaTalk] Verify your email address!',
            html,
          };
          await SendGridMail.send(msg);
          return true;
        }
        return false;
      } catch (err) {
        throw ErrorEmailSentFailed(err);
      }
    },
    findPassword: async (_, args): Promise<boolean> => {
      const email = args.email;

      if (!email || !validateEmail(email)) {
        throw ErrorEmailNotValid();
      }

      const hashedEmail = await encryptCredential(email);

      const msg = {
        to: email,
        from: 'noreply@hackatalk.dev',
        subject: '[HackaTalk] Reset your password!',
        html: getPasswordResetHTML(email, hashedEmail),
      };
      try {
        await SendGridMail.send(msg);
        return true;
      } catch (err) {
        throw ErrorEmailSentFailed(err);
      }
    },
    updateProfile: async (_, args, { verifyUser, models, pubsub }): Promise<User> => {
      try {
        const auth = verifyUser();
        if (!auth) {
          throw ErrorUserNotSignedIn();
        }
        await models.User.update(
          args.user,
          {
            where: {
              id: auth.userId,
            },
          },
        );

        const user = await models.User.findOne({
          where: {
            id: auth.userId,
          },
          raw: true,
        });

        pubsub.publish(USER_UPDATED, { user });
        return user;
      } catch (err) {
        throw new Error(err.message);
      }
    },
    setOnlineStatus: async (_, args, { verifyUser, models, pubsub }): Promise<number> => {
      try {
        const auth = verifyUser();
        if (!auth) { throw ErrorUserNotSignedIn(); }

        const update = await models.User.update(
          {
            isOnline: args.isOnline || false,
          },
          {
            where: {
              id: auth.userId,
            },
          },
        );

        pubsub.publish(USER_UPDATED, { user: auth });

        return update[0];
      } catch (err) {
        throw new Error(err.message);
      }
    },
    changeEmailPassword: async (
      _, { password, newPassword }, { verifyUser, models }): Promise<boolean> => {
      try {
        const auth = verifyUser();
        checkAuth(auth);

        const { User: userModel } = models;

        const user = await userModel.findOne({
          where: {
            id: auth.userId,
          },
          raw: true,
        });

        if (!user) throw ErrorUserNotExists();

        const validate = await validateCredential(password, user.password);

        if (!validate) throw ErrorPasswordIncorrect();

        newPassword = await encryptCredential(newPassword);

        const update = await models.User.update(
          {
            password: newPassword,
          },
          {
            where: {
              id: auth.userId,
            },
          },
        );

        return !!update[0];
      } catch (err) {
        throw new Error(err.message);
      }
    },
  },
  Subscription: {
    userSignedIn: {
      // issue: https://github.com/apollographql/graphql-subscriptions/issues/192
      // eslint-disable-next-line
      subscribe: (_, args, { pubsub }) => pubsub.asyncIterator(USER_SIGNED_IN),
    },
    userUpdated: {
      subscribe: withFilter(
        (_, args, { pubsub }) => {
          return pubsub.asyncIterator(USER_UPDATED, { user: args.user });
        },
        (payload, { userId }) => {
          const { userUpdated: updatedUser } = payload;
          return updatedUser.id === userId;
        },
      ),
    },
  },
  User: {
    notifications: (_, args, { models }): Promise<Notification[]> => {
      const { id } = _;
      const { Notification: notificationModel } = models;

      return notificationModel.findAll({
        where: {
          userId: id,
        },
      });
    },
  },
};

export default resolver;
