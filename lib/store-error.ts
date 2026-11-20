export class StoreError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
    this.name = "StoreError";
  }
}
