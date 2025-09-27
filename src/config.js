// Number -> port
// String -> unix socket
export const PORT = process.env.PORT || 8080;

// Only used if PORT is unix socket
export const UNIX_SOCKET_PERMISSIONS = 0o777;

export const ALLOWED_ORIGINS = [
    'https://turbowarp.org',
    'https://experiments.turbowarp.org',
    'https://staging.turbowarp.org',
    'https://mirror.turbowarp.xyz'
];
