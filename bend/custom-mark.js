function custom_write(path, text) {
  const fs = require("fs");
  if (typeof path !== "string" || !path.length || path.includes("\0")) return io_fail(22);
  try {
    fs.writeFileSync(path, text);
    return io_done({ $: CID(Receipt), value: Buffer.byteLength(text, "utf8"), tag: 3 });
  } catch (error) { return io_fail(Math.abs(error.errno || 5)); }
}

io_eff(CID(write), custom_write);
