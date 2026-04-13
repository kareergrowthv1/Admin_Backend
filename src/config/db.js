const mysql = require('mysql2/promise');
const config = require('./index');

let pool = null;
let authPool = null;

const initializePool = async () => {
	if (pool) {
		return pool;
	}

	pool = mysql.createPool({
		host: config.database.host,
		port: config.database.port,
		user: config.database.user,
		password: config.database.password,
		// database: config.database.name, // Removed to support multi-tenant dynamic schemas without failing if default DB is missing
		waitForConnections: true,
		connectionLimit: config.database.poolSize,
		queueLimit: 0,
		charset: 'utf8mb4',
		timezone: '+00:00'
	});

	// Always create auth pool for users/roles/organizations (auth_db) — required for superadmin admin creation
	const authDbConfig = config.authDatabase || {
		host: config.database.host,
		port: config.database.port,
		user: config.database.user,
		password: config.database.password,
		name: 'auth_db',
		poolSize: config.database.poolSize
	};
	authPool = mysql.createPool({
		host: authDbConfig.host,
		port: authDbConfig.port,
		user: authDbConfig.user,
		password: authDbConfig.password,
		database: authDbConfig.name,
		waitForConnections: true,
		connectionLimit: authDbConfig.poolSize || 10,
		queueLimit: 0,
		charset: 'utf8mb4',
		timezone: '+00:00'
	});

	return pool;
};

const getPool = () => {
	if (!pool) {
		throw new Error('MySQL pool not initialized. Call initializePool first.');
	}
	return pool;
};

const query = async (sql, params = []) => {
	const connection = await getPool().getConnection();
	try {
		const [rows] = await connection.query(sql, params);
		return rows;
	} finally {
		connection.release();
	}
};

const getAuthPool = () => {
	if (!authPool) {
		throw new Error('Auth pool not initialized. Call initializePool first.');
	}
	return authPool;
};

/** Run a query against auth_db (users, roles, organizations, permissions). Use for all auth-related tables. */
const authQuery = async (sql, params = []) => {
	const connection = await getAuthPool().getConnection();
	try {
		const [rows] = await connection.query(sql, params);
		return rows;
	} finally {
		connection.release();
	}
};

const createDatabase = async (schemaName) => {
	const tempPool = mysql.createPool({
		host: config.database.host,
		port: config.database.port,
		user: config.database.user,
		password: config.database.password,
		waitForConnections: true,
		connectionLimit: 1,
		queueLimit: 0
	});

	try {
		const conn = await tempPool.getConnection();
		await conn.query(
			`CREATE DATABASE IF NOT EXISTS \`${schemaName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
		);
		conn.release();
	} finally {
		await tempPool.end();
	}
};

const executeSchema = async (schemaName, statements = []) => {
	if (!statements.length) {
		return;
	}

	const schemaPool = mysql.createPool({
		host: config.database.host,
		port: config.database.port,
		user: config.database.user,
		password: config.database.password,
		database: schemaName,
		waitForConnections: true,
		connectionLimit: 1,
		queueLimit: 0,
		charset: 'utf8mb4',
		timezone: '+00:00'
	});

	const conn = await schemaPool.getConnection();
	try {
		for (const statement of statements) {
			const upper = statement.trim().toUpperCase();
			if (!upper) {
				continue;
			}
			if (upper.startsWith('SELECT ')) {
				continue;
			}
			await conn.query(statement);
		}
	} finally {
		conn.release();
		await schemaPool.end();
	}
};

module.exports = {
	initializePool,
	getPool,
	getAuthPool,
	query,
	authQuery,
	createDatabase,
	executeSchema
};
