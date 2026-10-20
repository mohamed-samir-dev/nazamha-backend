import mongoose from "mongoose";

export const connectDB = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not defined in environment variables");

  // Pool sizing rationale:
  // Dashboard = 7 queries, auth cache miss = 3 queries → ~10 queries/request.
  // At 10 concurrent users that's ~100 in-flight queries.
  // Atlas M0/M2 free tier caps at 500 connections total; 50 is safe for a single
  // backend instance while leaving headroom for Atlas internal connections.
  // waitQueueTimeoutMS: fail fast (5 s) instead of queuing forever when pool is full.
  const isDev = process.env.NODE_ENV !== "production";

  await mongoose.connect(uri, {
    maxPoolSize: isDev ? 5 : 50,
    minPoolSize: isDev ? 1 : 5,
    waitQueueTimeoutMS: 5000,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 15000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    retryReads: true,
  });
  console.log(`✅ MongoDB connected: ${mongoose.connection.host}`);
  const topology = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== "isdbgrid") {
    await mongoose.disconnect();
    throw new Error("MongoDB must run as a replica set or sharded cluster: student and financial writes require transactions.");
  }

  mongoose.connection.on("error", (err) => {
    console.error("❌ MongoDB connection error:", err);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("⚠️  MongoDB disconnected — Mongoose will attempt automatic reconnection");
  });

  mongoose.connection.on("reconnected", () => {
    console.log("✅ MongoDB reconnected");
  });
};

export const disconnectDB = async (): Promise<void> => {
  await mongoose.connection.close();
  console.log("🔌 MongoDB disconnected cleanly");
};
