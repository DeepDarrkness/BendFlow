import Base

type ResourceState is Type:
  ResourceState{file: File}

def resource_open(path: String) -> IO(ResourceState):
  do IO<ResourceState>:
    file : File <- IO.try(File, File.open(path, "w"))
    return ResourceState{file}

def lifecycle.init.resource() -> IO(ResourceState):
  do IO<ResourceState>:
    path : String <- IO.try(String, IO.get_env("BENDFLOW_SERVICE_FILE"))
    resource_open(path)

def resource_written(got: File & Result<&1, &1, U32 & String, Unit>) -> ResourceState & Bool:
  (file, result) = got
  match result:
    case Done{unit}:
      (ResourceState{file}, True{})
    case Fail{error}:
      (ResourceState{file}, False{})

def resource_closed(got: File & Result<&1, &1, U32 & String, Unit>) -> IO(Unit):
  (file, result) = got
  do IO<Unit>:
    Unit <- File.close(file)
    IO.print("resource finalized")

def lifecycle.finalize.resource(state: ResourceState) -> IO(Unit):
  match state:
    case ResourceState{file}:
      do IO<Unit>:
        got : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, "|closed")
        resource_closed(got)

def api.resource(state: ResourceState, text: String, enabled: Bool) -> IO(ResourceState & Bool):
  match state enabled:
    case ResourceState{file} True{}:
      do IO<ResourceState & Bool>:
        got : File & Result<&1, &1, U32 & String, Unit> <- File.write(file, text)
        return resource_written(got)
    case other False{}:
      IO.pure(ResourceState & Bool, (other, False{}))

type ProcessReply is Data:
  Success{status: U32, stdout: String, stderr: String}
  Failure{code: U32}

def process_reply(result: Result<&1, &1, U32 & String, U32 & (String & String)>) -> ProcessReply:
  match result:
    case Done{(status, (stdout, stderr))}:
      Success{status, stdout, stderr}
    case Fail{(code, message)}:
      Failure{code}

def api.process(input: String) -> IO(ProcessReply):
  do IO<ProcessReply>:
    result : Result<&1, &1, U32 & String, U32 & (String & String)> <- Process.run("/bin/cat", [], input, 96, 1000)
    return process_reply(result)

def channel_value(value: String) -> IO(String):
  do IO<String>:
    IO.sleep(1)
    return value

def api.channel(value: String) -> IO(String):
  do IO<String>:
    channel : Chan(String) <- IO.fork(String, channel_value(value))
    IO.join(String, channel)

def sent(got: Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit>) -> IO(Bool):
  match got:
    case (socket, Done{unit}):
      do IO<Bool>:
        Unit <- Socket.close(socket)
        return True{}
    case (socket, Fail{error}):
      do IO<Bool>:
        Unit <- Socket.close(socket)
        return False{}

def api.loopback(port: U32) -> IO(Bool):
  do IO<Bool>:
    socket : Socket <- IO.try(Socket, TCP.connect("127.0.0.1", port))
    got : Socket & Result<&1, &1, (U32 & String) & List<&2, U32>, Unit> <- TCP.send_bytes(socket, [66, 101, 110, 100])
    sent(got)
