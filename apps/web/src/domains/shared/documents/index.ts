/**
 * Shared document upload pipeline (same-origin upload → confirm → view link),
 * used by the applicant and company document flows.
 */
export {
  confirmDocumentUpload,
  documentDownloadResponse,
  downloadDocument,
  presignDocumentUpload,
  viewDocumentLink,
  VIEW_LINK_SECONDS,
  type ConfirmableDocument,
  type ConfirmDocumentOptions,
  type DocumentLink,
  type DocumentTable,
  type PresignedDocument,
  type PresignDocumentOptions,
  type SignedIn,
} from './confirm';
export { readUploadBody, receiveDocumentUpload, type ReceivedUpload } from './upload';
