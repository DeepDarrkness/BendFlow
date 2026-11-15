#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 3) return 64;
  char input[128];
  size_t count = fread(input, 1, sizeof(input) - 1, stdin);
  input[count] = 0;
  const char *marker = getenv("BENDFLOW_PROCESS_MARKER");
  if (!marker) return 65;
  FILE *file = fopen(marker, "a");
  if (!file) return 66;
  if (fprintf(file, "mode=%s;arg=%s;stdin=%s\n", argv[1], argv[2], input) < 0 || fclose(file)) return 67;
  if (!strcmp(argv[1], "timeout")) { sleep(3); return 0; }
  if (!strcmp(argv[1], "overflow")) {
    for (int i = 0; i < 110; i++) fputc('o', stdout);
    for (int i = 0; i < 110; i++) fputc('e', stderr);
    return 0;
  }
  if (!strcmp(argv[1], "success")) { fputs("ok\n", stdout); return 0; }
  if (strcmp(argv[1], "report")) return 68;
  printf("mode=%s;arg=%s;stdin=%s\n", argv[1], argv[2], input);
  fputs("fixture stderr\n", stderr);
  return 7;
}
