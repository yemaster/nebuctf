FROM python:3.13-alpine
WORKDIR /app
COPY generate.py .
USER 65534:65534
CMD ["python", "-B", "generate.py"]
