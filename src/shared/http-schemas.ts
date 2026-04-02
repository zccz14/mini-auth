import { z } from 'zod';

export const emailStartSchema = z.object({
  email: z.email(),
});

export const emailVerifySchema = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

const baseCredentialSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal('public-key'),
});

export const webauthnRegisterVerifySchema = z.object({
  request_id: z.uuid(),
  credential: baseCredentialSchema.extend({
    clientExtensionResults: z.record(z.string(), z.unknown()),
    response: z.object({
      clientDataJSON: z.string().min(1),
      attestationObject: z.string().min(1),
      transports: z.array(z.string().min(1)).optional(),
    }),
  }),
});

export const webauthnAuthenticateVerifySchema = z.object({
  request_id: z.uuid(),
  credential: baseCredentialSchema.extend({
    response: z.object({
      clientDataJSON: z.string().min(1),
      authenticatorData: z.string().min(1),
      signature: z.string().min(1),
      userHandle: z.string().nullable().optional(),
    }),
  }),
});
