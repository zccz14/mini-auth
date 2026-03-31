# mini-auth

Minimal Authentication Modules for Any App. Supports Email login, WebAuthn (Passkey) and JWT-based authentication. Using Hono HTTP Server and SQLite Database.

JWT is used for stateless authentication, allowing users to authenticate without maintaining server-side sessions. This makes it ideal for APIs and microservices.

No need to use Supabase or Firebase for auth-only simple projects. Extremely easy to set up and use. Just run the server and start using the auth endpoints.

```bash
# Initialize the database and initialize the SMTP and JWKS configurations.
# This command will create a `mini-auth.sqlite` file in the current directory to store user data, sessions, and configurations.
# SMTP Configuration is stored in the `smtp_config` table, and JWKS keys are stored in the `jwks_keys` table in the SQLite database.
npx mini-auth create

# Start the auth server from sqlite file. (mini-auth.sqlite)
npx mini-auth start mini-auth.sqlite --port 7777
# Auth server is running at http://localhost:7777
# The Database is stored at ./mini-auth.sqlite
```

## Features

- Email-based sign-up and sign-in
- WebAuthn (Passkey) support with discoverable credentials for password-less authentication
- JWT for stateless authentication
- SQLite database for storing user data. Easy to set up, use, and backup.
- Built with Hono HTTP Server for high performance and low latency.
- CORS support for cross-origin requests, making it easy to integrate with frontend applications.
- Refresh / Access token mechanism for secure authentication and session management.

### Why Email-based authentication?

Email is a widely used and familiar method for user authentication. It allows users to sign up and sign in using their email address, which is often more convenient than creating and remembering a separate username. Additionally, email-based authentication can be easily implemented with verification codes sent to the user's email, providing an extra layer of security. This method also allows for easy account recovery in case users forget their credentials, as they can simply request a new verification code to be sent to their email address.

Compared to Web3 authentication methods, email-based authentication is more accessible to a wider audience, as it does not require users to have a cryptocurrency wallet or understand blockchain technology. It also provides a more traditional and familiar user experience, which can be beneficial for applications targeting a general audience. For most of the applications, email can provide an additional communication channel with users, allowing for sending notifications, updates, and other important information directly to their inbox. And the web3 authentication methods cannot change password if the private key is lost, but email allows users to regain access to their account.

### Why password-less authentication? (OTP and WebAuthn)

Password is the most common method for authentication, but it has several drawbacks. Users often choose weak passwords or reuse passwords across multiple sites, which can lead to security vulnerabilities. Passwords can also be easily forgotten, leading to account lockouts and frustration for users.

Password should be encrypted and stored securely in the database, but it can still be vulnerable to breaches and leaks. If a password is compromised, attackers can gain unauthorized access to user accounts and sensitive information.

Email OTP (One-Time Password) provides a more secure alternative to traditional password-based authentication. It eliminates the need for users to remember complex passwords, which can be easily forgotten or compromised. With email OTP, users receive a unique code (e.g. 6-digits) in their email inbox that they can use to authenticate themselves. This method is resistant to phishing attacks and credential stuffing, as the OTP is only valid for a short period of time and cannot be reused.

Password-less authentication also using WebAuthn (Passkey) provides a more secure and user-friendly authentication experience. It eliminates the need for users to remember complex passwords, which can be easily forgotten or compromised. With WebAuthn, users can authenticate using their device's built-in biometric sensors (e.g., fingerprint or facial recognition) or a hardware security key, providing a strong level of security against phishing attacks and credential stuffing. Additionally, WebAuthn credentials are unique to each user and device, making it difficult for attackers to reuse stolen credentials across different accounts or services.

mini-auth uses discoverable credentials for Passkey login. This means users first sign in with email, then register a Passkey while authenticated. After that, they can sign in with the Passkey directly without entering their email address first. During login, the server returns a WebAuthn challenge without requiring an email address, and the browser or operating system can show any locally available Passkeys for this site. The selected credential is then sent back to the server for verification, and mini-auth identifies the user from the credential ID.

To support this flow, Passkey registration should create a discoverable credential (also known as a resident credential). This is required for username-less login. Non-discoverable WebAuthn credentials usually require the server to know the user first and provide an allow-list of credential IDs, which would require the user to enter an email address or username before authentication.

For this reason, `POST /webauthn/authenticate/options` should not require an email address, username, or credential ID. The request body can be empty. The server only needs to generate a new challenge and return `PublicKeyCredentialRequestOptions` without `allowCredentials`. The browser will then ask the operating system or authenticator for any discoverable Passkeys that match the RP ID.

`POST /webauthn/authenticate/verify` should receive the assertion returned by `navigator.credentials.get()` together with a server-issued request identifier such as `request_id`. The server can use `request_id` to load the latest unexpired challenge, verify the assertion, and then identify the user from the returned credential ID.

Calling `POST /webauthn/authenticate/options` again should replace the previous unused login challenge. This means a new options request can be used as a refresh of the Passkey login ceremony, and a separate cancel endpoint is not required. The same challenge lifecycle can also be used for `POST /webauthn/register/options`.

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

- `POST /email/start` - Sign up or sign in with email, server will send a verification email with a verification code.
- `POST /email/verify` - Verify email with the verification code sent to the user's email. Once verified, the user will be created if not exists and associated with the email. And a session with refresh/access token pair will be returned for authentication.
- `GET /me` - Get the authenticated user's profile. Requires a valid JWT token in the Authorization header. This endpoint will return the user's profile information, including `user_id` (UUID), associated `email` and WebAuthn credentials list and active sessions list.
- `POST /session/refresh` - Refresh the JWT token using a valid refresh token. Requires a valid refresh token in the Authorization header. Returns a new access token and refresh token pair.
- `POST /session/logout` - Logout from the current session. Requires a valid JWT token in the Authorization header. This will invalidate the current refresh token, but the access token will still be valid until it expires.

WebAuthn (Passkey) endpoints:

- `POST /webauthn/register/options` - Get WebAuthn registration options for the authenticated user. Requires a valid JWT token in the Authorization header. The returned options should create a discoverable credential so the Passkey can later be used for username-less login.
- `POST /webauthn/register/verify` - Verify and store a new WebAuthn credential for the authenticated user. Requires a valid JWT token in the Authorization header.
- `POST /webauthn/authenticate/options` - Get a WebAuthn authentication challenge for username-less Passkey login. No email address is required at this step. The request body can be empty, and the returned options should not include `allowCredentials`.
- `POST /webauthn/authenticate/verify` - Authenticate with a WebAuthn credential. The request should include the assertion returned by the browser together with the server-issued `request_id`. mini-auth uses `request_id` to load the challenge and identifies the user by the returned credential ID before returning a session with refresh/access token pair if successful.
- `DELETE /webauthn/credentials/:id` - Delete a WebAuthn credential by its ID. Requires a valid JWT token in the Authorization header.

### Passkey Flow Notes

- Passkey registration is an authenticated action. Users sign in with email first, then bind one or more discoverable Passkeys to their account.
- Passkey authentication is username-less. The client first calls `POST /webauthn/authenticate/options` with an empty body, then calls `navigator.credentials.get()` with the returned challenge.
- The server should generate a `request_id` for each register or authenticate challenge. The client sends this `request_id` back to the matching `verify` endpoint.
- Generating a new register or authenticate challenge should invalidate the previous unused challenge of the same type. This provides refresh semantics without needing a separate cancel endpoint.

## Operations

To rotate the JWKS keys, run the following command:

```bash
npx mini-auth rotate-jwks
```

This will generate a new set of JWKS keys and update the database. Existing JWT tokens signed with the old keys will become invalid, so users will need to sign in again to obtain new tokens.

## License

MIT License
