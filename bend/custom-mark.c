Term mark_run(Env e, Term* f, IoWork* w) {
  uint64_t n = 0;
  char* path = io_cstr(e, f[0], &n);
  if (path == NULL || io_nul(path, n)) {
    free(path);
    return io_fail(e, EINVAL, NULL);
  }
  int fd;
  do {
    fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  } while (fd < 0 && errno == EINTR);
  if (fd < 0) {
    uint32_t code = (uint32_t)errno;
    free(path);
    return io_fail(e, code, NULL);
  }
  const char msg[] = "custom\n";
  ssize_t wrote;
  do {
    wrote = write(fd, msg, 7);
  } while (wrote < 0 && errno == EINTR);
  uint32_t code = wrote < 0 ? (uint32_t)errno : 0;
  close(fd);
  free(path);
  return code ? io_fail(e, code, NULL) : io_done(e, (Term)7);
}

static void __attribute__((constructor)) mark_use(void) {
  io_eff(CID(mark), mark_run);
}
