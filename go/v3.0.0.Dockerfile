FROM openwhisk/action-golang-v1.12

WORKDIR /action
ENV GO111MODULE=on
RUN go get "github.com/fauna/faunadb-go/v3/faunadb"

ENTRYPOINT [ "/bin/proxy" ]