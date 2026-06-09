declare module "sql.js" {
  export type SqlValue = string | number | Uint8Array | null;

  export type QueryExecResult = {
    columns: string[];
    values: SqlValue[][];
  };

  export type Statement = {
    bind(values?: SqlValue[] | Record<string, SqlValue>): boolean;
    step(): boolean;
    get(): SqlValue[];
    getAsObject(): Record<string, SqlValue>;
    free(): boolean;
  };

  export type Database = {
    exec(sql: string, params?: SqlValue[]): QueryExecResult[];
    run(sql: string, params?: SqlValue[]): Database;
    prepare(sql: string, params?: SqlValue[]): Statement;
    export(): Uint8Array;
  };

  export type SqlJsStatic = {
    Database: new (data?: Uint8Array) => Database;
  };

  export default function initSqlJs(options?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
