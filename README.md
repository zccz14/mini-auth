# mini-auth

Minimal Authorization and Authentication Modules for Any App. Support Email, WebAuthn (Passkey) and JWT. Using Hono HTTP Server and SQLite Database.

JWT is used for stateless authentication, allowing users to authenticate without maintaining server-side sessions. This makes it ideal for APIs and microservices.

No need to use Supabase or Firebase for auth-only simple projects. Extremely easy to set up and use. Just run the server and start using the auth endpoints.

```bash
npx mini-auth start
# Auth server is running at http://localhost:7777
# The Database is stored at ./mini-auth.sqlite
```

## Features

- Email-based sign-up and sign-in
- WebAuthn (Passkey) support for password-less authentication
- JWT for stateless authentication
- SQLite database for storing user data. Easy to set up, use, and backup.
- Built with Hono HTTP Server for high performance and low latency.
- CORS support for cross-origin requests, making it easy to integrate with frontend applications.
- Refresh / Access token mechanism for secure authentication and session management.

### Why Email-based authentication?

Email is a widely used and familiar method for user authentication. It allows users to sign up and sign in using their email address, which is often more convenient than creating and remembering a separate username. Additionally, email-based authentication can be easily implemented with verification codes sent to the user's email, providing an extra layer of security. This method also allows for easy account recovery in case users forget their credentials, as they can simply request a new verification code to be sent to their email address.

Compared to Web3 authentication methods, email-based authentication is more accessible to a wider audience, as it does not require users to have a cryptocurrency wallet or understand blockchain technology. It also provides a more traditional and familiar user experience, which can be beneficial for applications targeting a general audience. For most of the applications, email can provide an additional communication channel with users, allowing for sending notifications, updates, and other important information directly to their inbox. And the web3 authentication methods cannot change password if the private key is lost, but email-based authentication allows users to reset their password and regain access to their account.

### Why password-less authentication? (OTP and WebAuthn)

Password-less authentication using WebAuthn (Passkey) provides a more secure and user-friendly authentication experience. It eliminates the need for users to remember complex passwords, which can be easily forgotten or compromised. With WebAuthn, users can authenticate using their device's built-in biometric sensors (e.g., fingerprint or facial recognition) or a hardware security key, providing a strong level of security against phishing attacks and credential stuffing. Additionally, WebAuthn credentials are unique to each user and device, making it difficult for attackers to reuse stolen credentials across different accounts or services. Overall, password-less authentication enhances security while improving the user experience by reducing friction during the sign-in process.

### Why SQLite?

SQLite is a lightweight, file-based database that is easy to set up and use. It does not require a separate server process, making it ideal for small to medium-sized applications or projects that do not require the scalability of a full-fledged database server.

User's auth data is very small, so SQLite is sufficient for storing user profiles, credentials, and sessions. It also allows for easy backup and portability, as the entire database is stored in a single file.

And thanks to JWT's stateless nature, service can verify the authenticity of the token without needing to query the database for every request, which can help mitigate performance concerns when using SQLite.

### Why Access and Refresh Tokens Matter?

Access and Refresh tokens for secure authentication and session management.

Refresh token is not a JWT Token, but a random string stored in the database for better security. When refreshing tokens, the old refresh token will be invalidated and a new refresh token will be issued.

Access token is a JWT token that contains user information and is used for authenticating API requests. JWT tokens are signed with a private key and can be verified using the corresponding public key from the JWKS endpoint.

But the JWT Token cannot be revoked until it expires. So if a long-term JWT token is leaked, it can be used by attackers until it expires. By using short-lived access tokens and long-lived refresh tokens, we can minimize the risk of token leakage and unauthorized access.

Access token has a short expiration time (e.g., 15 minutes) for security, while refresh token has a longer expiration time (e.g., 7 days) to allow users to stay logged in without frequent re-authentication.

## Endpoints

Public endpoints:

- `GET /health` - Health check endpoint to verify that the server is running.
- `GET /jwks` - Get the JSON Web Key Set (JWKS) for verifying JWT tokens.

Sign-up and sign-in endpoints:

- `POST /sign-email` - Sign up or sign in with email, server will send a verification email with a verification code.
- `POST /verify-email` - Verify email with the verification code sent to the user's email. Once verified, the user will be created if not exists and associated with the email. And a session with refresh/access token pair will be returned for authentication.
- `GET /me` - Get the authenticated user's profile. Requires a valid JWT token in the Authorization header. This endpoint will return the user's profile information, including `user_id` (UUID), associated `email` and WebAuthn credentials list and active sessions list.
- `POST /session/refresh` - Refresh the JWT token using a valid refresh token. Requires a valid JWT token in the Authorization header.

WebAuthn (PassKey) endpoints:

- `POST /webauthn/register/options` - Get the WebAuthn options for registration or authentication. Requires a valid JWT token in the Authorization header.
- `POST /webauthn/register/verify` - Register a new WebAuthn credential for the authenticated user. Requires a valid JWT token in the Authorization header.
- `POST /webauthn/login/options` - Get the WebAuthn options for authentication. Requires a valid JWT token in the Authorization header.
- `POST /webauthn/login/verify` - Authenticate with a WebAuthn credential. Requires a valid JWT token in the Authorization header.

## Operations

To rotate the JWKS keys, run the following command:

```bash
npx mini-auth rotate-jwks
```

This will generate a new set of JWKS keys and update the database. Existing JWT tokens signed with the old keys will become invalid, so users will need to sign in again to obtain new tokens.

# License

MIT License
