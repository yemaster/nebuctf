FROM python:3.12-slim
WORKDIR /checker
COPY check.py .
USER 65534:65534
CMD ["python", "-B", "check.py"]
