static void custom_write_call(IoWork* w) {
  int fd;
  do { fd = open(w->text, O_WRONLY | O_CREAT | O_TRUNC, 0644); }
  while (fd < 0 && errno == EINTR);
  if (fd < 0) { w->code = (uint32_t)errno; return; }
  for (uint64_t at = 0; at < w->size;) {
    ssize_t n;
    do { n = write(fd, w->data + at, w->size - at); }
    while (n < 0 && errno == EINTR);
    if (n <= 0) { w->code = n < 0 ? (uint32_t)errno : EIO; break; }
    at += (uint64_t)n;
  }
  if (close(fd) < 0 && !w->code) w->code = (uint32_t)errno;
}

static Term custom_write_pack(Env e, IoWork* w) {
  Term result = w->code ? io_fail(e, w->code, NULL)
    : io_done(e, io_node(e, CID(Receipt), (Term)w->size, (Term)3));
  free(w->text);
  free(w->data);
  return result;
}

Term custom_write_run(Env e, Term* f, IoWork* w) {
  uint64_t n = 0;
  w->text = io_cstr(e, f[0], &n);
  w->data = io_cstr(e, f[1], &w->size);
  w->code = !w->text || !n || io_nul(w->text, n) || !w->data ? EINVAL : 0;
  if (w->code) return custom_write_pack(e, w);
  io_sync();
  return io_work(w, custom_write_call, custom_write_pack);
}

static void __attribute__((constructor)) custom_write_use(void) {
  io_eff(CID(write), custom_write_run);
}
