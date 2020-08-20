FROM openwhisk/python3action:latest

WORKDIR /pythonAction
RUN pip install -Iv faunadb===2.12.0

CMD ["/bin/bash", "-c", "cd pythonAction && python -u pythonrunner.py"]