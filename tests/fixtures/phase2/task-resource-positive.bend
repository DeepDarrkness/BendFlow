import Base

def job(file: File) -> IO(File):
  IO.pure(File, file)

def transfer(file: File) -> IO(Unit):
  do IO<Unit>:
    result : Chan(File) <- IO.fork(File, job(file))
    returned : File <- IO.join(File, result)
    File.close(returned)
