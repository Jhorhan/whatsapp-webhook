module.exports = {
  apps: [
    {
      name: 'whatsapp-webhook',              // Nombre del bot
      script: './dist/index.js',             // Archivo compilado de TypeScript
      env: {
        NODE_ENV: 'development',
        NODE_OPTIONS: '--dns-result-order=ipv4first',  // Evita problemas con Meta
        PORT: 3500                              // Tu puerto
      },
      env_production: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--dns-result-order=ipv4first',
        PORT: 3500
      }
    }
  ]
};
