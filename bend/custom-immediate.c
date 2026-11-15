Term custom_immediate_run(Env e, Term* f, IoWork* w) {
  return io_node(e, CID(Receipt), f[0], (Term)1);
}

static void __attribute__((constructor)) custom_immediate_use(void) {
  io_eff(CID(immediate), custom_immediate_run);
}
