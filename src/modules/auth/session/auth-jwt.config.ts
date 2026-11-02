export function jwtVerifyOptions() {
  return {
    algorithms: ['HS256'] as ['HS256'],
    issuer: process.env.JWT_ISSUER ?? 'jobaura',
    audience: process.env.JWT_AUDIENCE ?? 'jobaura-api',
  };
}
