function mark(path) {
  const fs = require("fs");
  if (typeof path !== "string" || path.includes("\0")) return io_fail(22);
  fs.writeFileSync(path, "custom\n");
  return io_done(7);
}

io_eff(CID(mark), mark);
