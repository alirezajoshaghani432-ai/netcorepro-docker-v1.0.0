// Lightweight ambient declaration for 'mssql' to avoid hard dependency on @types/mssql.
// The actual mssql package is loaded dynamically only when DB_TYPE=mssql.
declare module 'mssql' {
  export interface IResult<T = any> {
    recordset: T[];
    recordsets: T[][];
    rowsAffected: number[];
    output: Record<string, any>;
  }
  export interface ConnectionPool {
    connected: boolean;
    request(): Request;
    close(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): this;
  }
  export interface Request {
    input(name: string, value: any): Request;
    query<T = any>(sql: string): Promise<IResult<T>>;
  }
  export interface config {
    server: string;
    database: string;
    user: string;
    password: string;
    port?: number;
    options?: {
      encrypt?: boolean;
      trustServerCertificate?: boolean;
      enableArithAbort?: boolean;
    };
    pool?: {
      max?: number;
      min?: number;
      idleTimeoutMillis?: number;
    };
  }
  export function connect(cfg: config): Promise<ConnectionPool>;
  const _default: {
    connect: typeof connect;
  };
  export default _default;
}
