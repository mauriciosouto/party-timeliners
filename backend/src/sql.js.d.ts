declare module "sql.js" {
  interface SqlJsStatic {
    Database: new (data?: ArrayBuffer | Uint8Array) => SqlJsDatabase;
  }
  interface SqlJsDatabase {
    run(sql: string): void;
    exec(sql: string): unknown;
    prepare(sql: string): SqlJsStatement;
    close(): void;
    export(): Uint8Array;
  }
  interface SqlJsStatement {
    bind(values: unknown[] | Record<string, unknown>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    getObject(): Record<string, unknown>;
    reset(): void;
    free(): void;
  }
  function initSqlJs(options?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
  export = initSqlJs;
}
