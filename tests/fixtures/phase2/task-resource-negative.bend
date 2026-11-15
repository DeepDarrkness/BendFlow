import Base

def job(file: File) -> IO(File):
  IO.pure(File, file)

def duplicate(file: File) -> IO(Unit):
  do IO<Unit>:
    result : Chan(File) <- IO.fork(File, job(file))
    File.close(file)
