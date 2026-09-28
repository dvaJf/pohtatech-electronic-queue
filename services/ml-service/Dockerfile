FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /app/seed && python train.py --output /app/seed/eta.joblib
EXPOSE 8090
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8090"]
