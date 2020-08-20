FROM openwhisk/action-golang-v1.12

ENV GO111MODULE=off
WORKDIR $GOPATH/src
RUN mkdir github.com/fauna -p
WORKDIR $GOPATH/src/github.com/fauna
RUN git clone https://github.com/fauna/faunadb-go
WORKDIR $GOPATH/src/github.com/fauna/faunadb-go
RUN git checkout tags/v2.10.0

WORKDIR /action

ENTRYPOINT [ "/bin/proxy" ]