static Term custom_parked_more(Env e, IoWork* w) {
  return io_node(e, CID(Receipt), (Term)w->made, (Term)4);
}

Term custom_parked_run(Env e, Term* f, IoWork* w) {
  w->made = (intptr_t)(uint32_t)f[1];
  return io_wait_on(w, 0, 0, io_tick() + (uint64_t)(uint32_t)f[0] * 1000000ull,
    custom_parked_more);
}

static void __attribute__((constructor)) custom_parked_use(void) {
  io_eff(CID(parked), custom_parked_run);
}
