function custom_parked(milliseconds, value, k) {
  io_park_on(undefined, false, k,
    () => ({ $: CID(Receipt), value, tag: 4 }), performance.now() + milliseconds);
}

io_eff(CID(parked), custom_parked);
