import { Gallery, Resolvers } from '../generated/graphql';

import { AuthenticationError } from 'apollo-server-core';

const resolver: Resolvers = {
  Mutation: {
    createGallery: async (_, { photoURL }, { verifyUser, models }): Promise<Gallery> => {
      const auth = verifyUser();

      if (!auth) throw new AuthenticationError('User is not signed in');

      const { Gallery: galleryModel } = models;
      const gallery = await galleryModel.create({
        photoURL,
        userId: auth.userId,
      });

      return gallery;
    },
    updateGallery: async (_, { galleryId, photoURL }, { verifyUser, models }): Promise<number> => {
      const auth = verifyUser();

      if (!auth) throw new AuthenticationError('User is not signed in');
      const { Gallery: galleryModel } = models;

      const result = await galleryModel.update(
        {
          photoURL,
        },
        {
          where: {
            id: galleryId,
          },
        },
      );

      return result[0];
    },
    deleteGallery: async (_, { galleryId }, { verifyUser, models }): Promise<number> => {
      const auth = verifyUser();

      if (!auth) throw new AuthenticationError('User is not signed in');

      const { Gallery: galleryModel } = models;
      const result = await galleryModel.destroy({
        where: {
          id: galleryId,
        },
      });

      return result[0];
    },
  },
};

export default resolver;
