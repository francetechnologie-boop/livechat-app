module.exports = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: __dirname + '/migrations',
    tableName: 'knex_migrations'
  }
};

