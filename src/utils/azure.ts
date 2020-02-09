import AzureStorage, { BlobService } from 'azure-storage';

import stream from 'stream';

require('dotenv').config();

const {
  STORAGE_ACCOUNT,
  STORAGE_KEY,
} = process.env;

const blobService = STORAGE_ACCOUNT
  ? AzureStorage.createBlobService(
    STORAGE_ACCOUNT,
    STORAGE_KEY,
  )
  : undefined;

export const uploadFileToAzureBlobFromStream = (
  stream: stream.Readable,
  destFile: string,
  destDir: string,
  streamLength: number,
): Promise<BlobService.BlobResult> => {
  return new Promise(function(resolve, reject) {
    blobService.createBlockBlobFromStream(destDir, destFile, stream, streamLength, function(
      error,
      resultUpload,
    ) {
      if (!error) {
        resolve(resultUpload);
        return;
      }
      reject(error);
    });
  });
};

export const uploadFileToAzureBlobFromFile = (
  file: string,
  destFile: string,
  destDir: string,
): Promise<BlobService.BlobResult> => {
  return new Promise(function(resolve, reject) {
    blobService.createBlockBlobFromLocalFile(destDir, destFile, file, function(
      error,
      resultUpload,
    ) {
      if (!error) {
        resolve(resultUpload);
        return;
      }
      reject(error);
    });
  });
};

export const deleteFileFromAzureBlob = (
  destFile: string,
  destDir: string,
): Promise<boolean> => {
  return new Promise(function(resolve, reject) {
    blobService.deleteBlobIfExists(destDir, destFile, function(
      error,
      resultUpload,
    ) {
      if (!error) {
        resolve(resultUpload);
        return;
      }
      reject(error);
    });
  });
};
