import mysql from "mysql2/promise";

let pool: mysql.Pool | undefined;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "videogenerator",
      waitForConnections: true,
      connectionLimit: 10,
      dateStrings: true,
    });
  }
  return pool;
}

export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  const [rows] = await getPool().execute(sql, params);
  return rows as T;
}
