-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3606
-- Generation Time: Apr 27, 2026 at 12:19 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `chating`
--

-- --------------------------------------------------------

--
-- Table structure for table `admins`
--

CREATE TABLE `admins` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `role` enum('admin') DEFAULT 'admin'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `admins`
--

INSERT INTO `admins` (`id`, `name`, `password`, `role`) VALUES
('admin', 'Admin', '$2b$10$9Guh7wDFyzxsd2eIw.sgXucRGOvvYLujajbEGveO6gPF/3YGBB/VW', 'admin');

-- --------------------------------------------------------

--
-- Table structure for table `calls`
--

CREATE TABLE `calls` (
  `id` int(11) NOT NULL,
  `group_id` int(11) DEFAULT NULL,
  `caller_id` varchar(50) DEFAULT NULL,
  `type` enum('group','private') DEFAULT NULL,
  `start_time` timestamp NOT NULL DEFAULT current_timestamp(),
  `end_time` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `calls`
--

INSERT INTO `calls` (`id`, `group_id`, `caller_id`, `type`, `start_time`, `end_time`) VALUES
(1, 17, 'd37279', 'group', '2026-04-25 10:55:33', '2026-04-25 10:55:50'),
(2, 17, 'd37279', 'private', '2026-04-25 10:55:58', '2026-04-25 10:56:06'),
(3, 17, 'd37279', 'private', '2026-04-25 11:17:44', '2026-04-25 11:18:36'),
(4, 17, 'admin', 'private', '2026-04-25 11:18:24', '2026-04-25 11:18:25'),
(5, 17, 'admin', 'private', '2026-04-25 11:18:27', '2026-04-25 11:18:29'),
(6, 17, 'u76675', 'group', '2026-04-25 11:18:41', '2026-04-25 11:18:42'),
(7, 17, 'u76675', 'private', '2026-04-25 11:18:47', '2026-04-25 11:18:49'),
(8, 17, 'admin', 'group', '2026-04-25 11:18:53', '2026-04-25 11:18:55'),
(9, 17, 'u76675', 'group', '2026-04-25 11:18:58', '2026-04-25 11:19:01'),
(10, 17, 'd37279', 'private', '2026-04-25 11:19:05', '2026-04-25 11:19:07'),
(11, 17, 'd37279', 'private', '2026-04-25 11:19:10', '2026-04-25 11:19:18'),
(12, 17, 'd37279', 'private', '2026-04-25 11:19:24', '2026-04-25 11:19:28'),
(13, 17, 'u76675', 'group', '2026-04-25 11:19:30', '2026-04-25 11:19:42'),
(14, 17, 'd37279', 'private', '2026-04-25 11:20:14', '2026-04-25 11:20:22'),
(15, 17, 'u76675', 'private', '2026-04-25 11:20:26', '2026-04-25 11:20:33'),
(16, 17, 'd37279', 'group', '2026-04-25 11:20:35', '2026-04-25 11:20:48'),
(17, 17, 'admin', 'private', '2026-04-25 11:20:57', NULL),
(18, 17, 'admin', 'private', '2026-04-25 11:21:02', '2026-04-25 11:21:07'),
(19, 17, 'd37279', 'private', '2026-04-25 11:21:27', '2026-04-25 11:21:38'),
(20, 17, 'admin', 'private', '2026-04-25 11:21:46', '2026-04-25 11:21:50'),
(21, 17, 'd37279', 'group', '2026-04-25 12:00:00', '2026-04-25 12:00:11'),
(22, 17, 'admin', 'private', '2026-04-25 12:00:21', '2026-04-25 12:00:25'),
(23, 17, 'd37279', 'private', '2026-04-25 12:00:29', '2026-04-25 12:00:35'),
(24, 17, 'u76675', 'private', '2026-04-25 12:00:47', NULL),
(25, 17, 'd37279', 'group', '2026-04-25 12:01:01', '2026-04-25 12:01:07'),
(26, 17, 'd37279', 'group', '2026-04-25 12:01:12', '2026-04-25 12:01:22'),
(27, 17, 'd37279', 'private', '2026-04-25 12:01:47', NULL),
(28, 17, 'admin', 'private', '2026-04-25 12:01:55', '2026-04-25 12:01:57'),
(29, 17, 'd37279', 'group', '2026-04-25 12:05:37', '2026-04-25 12:05:57'),
(30, 17, 'd37279', 'group', '2026-04-25 12:06:10', '2026-04-25 12:06:14'),
(31, 17, 'd37279', 'group', '2026-04-25 12:06:15', '2026-04-25 12:06:27'),
(32, 17, 'admin', 'private', '2026-04-25 12:06:32', '2026-04-25 12:06:35'),
(33, 17, 'd37279', 'private', '2026-04-25 12:06:38', '2026-04-25 12:06:49'),
(34, 17, 'd37279', 'private', '2026-04-25 12:06:52', '2026-04-25 12:07:03'),
(35, 17, 'd37279', 'private', '2026-04-25 12:07:08', NULL),
(36, 17, 'd37279', 'private', '2026-04-25 12:11:12', '2026-04-25 12:11:19'),
(37, 17, 'd37279', 'private', '2026-04-25 12:11:21', '2026-04-25 12:11:57'),
(38, 17, 'admin', 'private', '2026-04-25 12:11:38', '2026-04-25 12:11:49'),
(39, 17, 'd37279', 'private', '2026-04-25 12:12:00', '2026-04-25 12:12:27'),
(40, 17, 'admin', 'private', '2026-04-25 12:12:17', '2026-04-25 12:12:23'),
(41, 17, 'd37279', 'private', '2026-04-25 12:12:32', '2026-04-25 12:12:36'),
(42, 17, 'u76675', 'private', '2026-04-25 12:12:39', '2026-04-25 12:12:43'),
(43, 17, 'd37279', 'group', '2026-04-25 12:13:05', '2026-04-25 12:13:13'),
(44, 17, 'd37279', 'group', '2026-04-25 12:13:15', '2026-04-25 12:13:19'),
(45, 17, 'u76675', 'group', '2026-04-25 12:13:21', '2026-04-25 12:13:27'),
(46, 17, 'd37279', 'private', '2026-04-25 12:16:24', '2026-04-25 12:16:29'),
(47, 17, 'admin', 'private', '2026-04-25 12:16:35', '2026-04-25 12:16:37'),
(48, 17, 'd37279', 'group', '2026-04-25 12:16:40', '2026-04-25 12:16:51'),
(49, 17, 'd37279', 'group', '2026-04-25 12:16:53', '2026-04-25 12:16:54'),
(50, 17, 'd37279', 'group', '2026-04-25 12:16:56', '2026-04-25 12:16:57'),
(51, 17, 'u76675', 'group', '2026-04-25 13:20:52', '2026-04-25 13:21:02'),
(52, 17, 'admin', 'group', '2026-04-25 13:21:14', '2026-04-25 13:21:18');

-- --------------------------------------------------------

--
-- Table structure for table `call_participants`
--

CREATE TABLE `call_participants` (
  `id` int(11) NOT NULL,
  `call_id` int(11) DEFAULT NULL,
  `user_id` varchar(50) DEFAULT NULL,
  `joined_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `left_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `call_participants`
--

INSERT INTO `call_participants` (`id`, `call_id`, `user_id`, `joined_at`, `left_at`) VALUES
(1, 1, 'd37279', '2026-04-25 10:55:33', '2026-04-25 10:55:50'),
(2, 1, 'admin', '2026-04-25 10:55:34', '2026-04-25 10:55:50'),
(3, 2, 'd37279', '2026-04-25 10:55:58', '2026-04-25 10:56:06'),
(4, 2, 'u76675', '2026-04-25 10:56:00', '2026-04-25 10:56:06'),
(5, 3, 'd37279', '2026-04-25 11:17:44', '2026-04-25 11:18:36'),
(6, 4, 'admin', '2026-04-25 11:18:24', '2026-04-25 11:18:25'),
(7, 5, 'admin', '2026-04-25 11:18:27', '2026-04-25 11:18:29'),
(8, 6, 'u76675', '2026-04-25 11:18:41', '2026-04-25 11:18:42'),
(9, 7, 'u76675', '2026-04-25 11:18:47', '2026-04-25 11:18:49'),
(10, 8, 'admin', '2026-04-25 11:18:53', '2026-04-25 11:18:55'),
(11, 9, 'u76675', '2026-04-25 11:18:58', '2026-04-25 11:19:01'),
(12, 10, 'd37279', '2026-04-25 11:19:05', '2026-04-25 11:19:07'),
(13, 11, 'd37279', '2026-04-25 11:19:10', '2026-04-25 11:19:18'),
(14, 11, 'u76675', '2026-04-25 11:19:11', NULL),
(15, 12, 'd37279', '2026-04-25 11:19:24', '2026-04-25 11:19:28'),
(16, 12, 'u76675', '2026-04-25 11:19:25', NULL),
(17, 13, 'u76675', '2026-04-25 11:19:30', '2026-04-25 11:19:42'),
(18, 13, 'd37279', '2026-04-25 11:19:31', '2026-04-25 11:19:36'),
(19, 14, 'd37279', '2026-04-25 11:20:14', NULL),
(20, 14, 'u76675', '2026-04-25 11:20:17', '2026-04-25 11:20:22'),
(21, 15, 'u76675', '2026-04-25 11:20:26', NULL),
(22, 15, 'd37279', '2026-04-25 11:20:27', '2026-04-25 11:20:33'),
(23, 16, 'd37279', '2026-04-25 11:20:35', '2026-04-25 11:20:47'),
(24, 16, 'u76675', '2026-04-25 11:20:37', '2026-04-25 11:20:48'),
(25, 17, 'admin', '2026-04-25 11:20:57', NULL),
(26, 18, 'admin', '2026-04-25 11:21:02', NULL),
(27, 18, 'u76675', '2026-04-25 11:21:04', '2026-04-25 11:21:07'),
(28, 19, 'd37279', '2026-04-25 11:21:27', NULL),
(29, 19, 'u76675', '2026-04-25 11:21:28', '2026-04-25 11:21:38'),
(30, 20, 'admin', '2026-04-25 11:21:46', NULL),
(31, 20, 'd37279', '2026-04-25 11:21:48', '2026-04-25 11:21:50'),
(32, 21, 'd37279', '2026-04-25 12:00:00', NULL),
(33, 21, 'admin', '2026-04-25 12:00:04', '2026-04-25 12:00:11'),
(34, 22, 'admin', '2026-04-25 12:00:21', NULL),
(35, 22, 'd37279', '2026-04-25 12:00:23', '2026-04-25 12:00:25'),
(36, 23, 'd37279', '2026-04-25 12:00:29', '2026-04-25 12:00:35'),
(37, 24, 'u76675', '2026-04-25 12:00:47', NULL),
(38, 25, 'd37279', '2026-04-25 12:01:01', '2026-04-25 12:01:07'),
(39, 26, 'd37279', '2026-04-25 12:01:12', '2026-04-25 12:01:21'),
(40, 26, 'admin', '2026-04-25 12:01:13', '2026-04-25 12:01:22'),
(41, 27, 'd37279', '2026-04-25 12:01:47', NULL),
(42, 28, 'admin', '2026-04-25 12:01:55', NULL),
(43, 29, 'd37279', '2026-04-25 12:05:37', '2026-04-25 12:05:54'),
(44, 29, 'admin', '2026-04-25 12:05:39', '2026-04-25 12:05:57'),
(45, 30, 'd37279', '2026-04-25 12:06:10', '2026-04-25 12:06:14'),
(46, 31, 'd37279', '2026-04-25 12:06:15', '2026-04-25 12:06:20'),
(47, 31, 'u76675', '2026-04-25 12:06:16', NULL),
(48, 31, 'admin', '2026-04-25 12:06:24', '2026-04-25 12:06:27'),
(49, 32, 'admin', '2026-04-25 12:06:32', NULL),
(50, 32, 'd37279', '2026-04-25 12:06:33', '2026-04-25 12:06:35'),
(51, 33, 'd37279', '2026-04-25 12:06:38', '2026-04-25 12:06:49'),
(52, 34, 'd37279', '2026-04-25 12:06:52', NULL),
(53, 34, 'u76675', '2026-04-25 12:06:55', '2026-04-25 12:07:03'),
(54, 35, 'd37279', '2026-04-25 12:07:08', NULL),
(55, 36, 'd37279', '2026-04-25 12:11:12', '2026-04-25 12:11:19'),
(56, 36, 'u76675', '2026-04-25 12:11:15', NULL),
(57, 37, 'd37279', '2026-04-25 12:11:21', '2026-04-25 12:11:57'),
(58, 38, 'admin', '2026-04-25 12:11:38', '2026-04-25 12:11:49'),
(59, 39, 'd37279', '2026-04-25 12:12:00', '2026-04-25 12:12:27'),
(60, 40, 'admin', '2026-04-25 12:12:17', '2026-04-25 12:12:23'),
(61, 41, 'd37279', '2026-04-25 12:12:32', NULL),
(62, 41, 'u76675', '2026-04-25 12:12:34', '2026-04-25 12:12:36'),
(63, 42, 'u76675', '2026-04-25 12:12:39', NULL),
(64, 42, 'd37279', '2026-04-25 12:12:40', '2026-04-25 12:12:43'),
(65, 43, 'd37279', '2026-04-25 12:13:05', NULL),
(66, 43, 'admin', '2026-04-25 12:13:07', '2026-04-25 12:13:10'),
(67, 43, 'u76675', '2026-04-25 12:13:11', '2026-04-25 12:13:13'),
(68, 44, 'd37279', '2026-04-25 12:13:15', '2026-04-25 12:13:19'),
(69, 45, 'u76675', '2026-04-25 12:13:21', NULL),
(70, 45, 'd37279', '2026-04-25 12:13:22', '2026-04-25 12:13:27'),
(71, 46, 'd37279', '2026-04-25 12:16:24', '2026-04-25 12:16:29'),
(72, 46, 'admin', '2026-04-25 12:16:25', NULL),
(73, 47, 'admin', '2026-04-25 12:16:35', NULL),
(74, 47, 'd37279', '2026-04-25 12:16:36', '2026-04-25 12:16:37'),
(75, 48, 'd37279', '2026-04-25 12:16:40', NULL),
(76, 48, 'admin', '2026-04-25 12:16:42', '2026-04-25 12:16:47'),
(77, 48, 'u76675', '2026-04-25 12:16:49', '2026-04-25 12:16:51'),
(78, 49, 'd37279', '2026-04-25 12:16:53', '2026-04-25 12:16:54'),
(79, 50, 'd37279', '2026-04-25 12:16:56', '2026-04-25 12:16:57'),
(80, 51, 'u76675', '2026-04-25 13:20:52', NULL),
(81, 51, 'd37279', '2026-04-25 13:20:53', '2026-04-25 13:21:02'),
(82, 52, 'admin', '2026-04-25 13:21:14', '2026-04-25 13:21:18'),
(83, 52, 'd37279', '2026-04-25 13:21:15', '2026-04-25 13:21:17');

-- --------------------------------------------------------

--
-- Table structure for table `groups`
--

CREATE TABLE `groups` (
  `id` int(11) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `created_by` varchar(50) DEFAULT NULL,
  `group_call_enabled` tinyint(1) DEFAULT 0,
  `personal_call_enabled` tinyint(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `groups`
--

INSERT INTO `groups` (`id`, `name`, `created_by`, `group_call_enabled`, `personal_call_enabled`) VALUES
(17, 'aa', 'admin', 1, 1),
(18, 'bbbbb', 'admin', 1, 1),
(29, 'eeeeeee', 'admin', 0, 0);

-- --------------------------------------------------------

--
-- Table structure for table `group_members`
--

CREATE TABLE `group_members` (
  `id` int(11) NOT NULL,
  `group_id` int(11) DEFAULT NULL,
  `user_id` varchar(50) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `group_members`
--

INSERT INTO `group_members` (`id`, `group_id`, `user_id`) VALUES
(50, 17, 'u76675'),
(51, 18, 'admin'),
(52, 18, 'd37279'),
(53, 18, 'u76675'),
(92, 17, 'd37279'),
(93, 29, 'admin'),
(94, 29, 'd37279'),
(95, 29, 'u34133'),
(96, 29, 'u76675');

-- --------------------------------------------------------

--
-- Table structure for table `messages`
--

CREATE TABLE `messages` (
  `id` int(11) NOT NULL,
  `group_id` int(11) DEFAULT NULL,
  `user_id` varchar(50) DEFAULT NULL,
  `content` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `type` enum('text','image','video','audio','document') DEFAULT 'text',
  `file_url` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `messages`
--

INSERT INTO `messages` (`id`, `group_id`, `user_id`, `content`, `created_at`, `type`, `file_url`) VALUES
(45, 17, 'u76675', NULL, '2026-04-23 12:42:59', 'image', '/uploads/1776948179793-442394420.jpeg'),
(46, 17, 'u76675', NULL, '2026-04-23 12:43:13', 'audio', '/uploads/1776948193585-486300000.webm'),
(47, 17, 'd37279', NULL, '2026-04-25 05:13:44', 'image', '/uploads/1777094024329-95533930.jpeg'),
(48, 17, 'u76675', 'ook', '2026-04-25 05:13:52', 'text', NULL),
(49, 17, 'd37279', 'okkkkkkk', '2026-04-25 05:13:55', 'text', NULL),
(50, 17, 'admin', 'good', '2026-04-25 05:14:04', 'text', NULL),
(51, 18, 'u76675', 'hii', '2026-04-25 05:42:32', 'text', NULL),
(52, 18, 'd37279', 'haa jii', '2026-04-25 05:42:41', 'text', NULL),
(53, 17, 'd37279', 'hi', '2026-04-25 06:03:55', 'text', NULL),
(54, 17, 'u76675', 'ky haal h', '2026-04-25 06:04:03', 'text', NULL),
(55, 17, 'u76675', 'bus badiya', '2026-04-25 06:04:06', 'text', NULL),
(56, 17, 'd37279', 'hiii', '2026-04-25 07:16:02', 'text', NULL),
(57, 17, 'u76675', 'gsdnsdbvksd', '2026-04-25 07:16:06', 'text', NULL),
(58, 17, 'admin', 'sdfsdfsdf', '2026-04-25 07:16:12', 'text', NULL),
(59, 17, 'd37279', 'hiuiii', '2026-04-25 11:41:00', 'text', NULL),
(60, 17, 'd37279', 'ky haal h', '2026-04-25 11:41:07', 'text', NULL),
(61, 17, 'u76675', 'bu basidcba\'', '2026-04-25 11:41:11', 'text', NULL),
(62, 17, 'd37279', 'hii', '2026-04-25 11:59:54', 'text', NULL),
(63, 17, 'admin', 'hsdnksd', '2026-04-25 11:59:57', 'text', NULL),
(64, 29, 'admin', 'hi', '2026-04-25 12:02:29', 'text', NULL),
(65, 17, 'd37279', 'hii', '2026-04-25 13:20:45', 'text', NULL),
(66, 17, 'u76675', 'hii', '2026-04-25 13:20:50', 'text', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `role` enum('admin','user','developer') DEFAULT 'user',
  `active` tinyint(1) DEFAULT 1,
  `profile_image` mediumtext DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `name`, `password`, `role`, `active`, `profile_image`) VALUES
('d37279', 'vishnu jii', '$2b$10$7UfcD509QT5EBbZ8Wr77buEh50m93Bj84P3zmxi2cpWjygJ1PChpq', 'developer', 1, '/uploads/1777117198061-763526873.png'),
('u34133', 'pawan ji', '$2b$10$MpuyhexGz27sDcbrrQ/wU.KBd9I9a6u.4zQk280MV/Hu4HwVyrUYq', 'user', 1, NULL),
('u76675', 'akash jiii', '$2b$10$O2OFYDHyJcrHnKnRkxKsDu.nUrEe9QPqeLUhEbJYKaIZlqM1SuRv2', 'user', 1, '/uploads/1777117250172-909092719.png');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `admins`
--
ALTER TABLE `admins`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `calls`
--
ALTER TABLE `calls`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `call_participants`
--
ALTER TABLE `call_participants`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `groups`
--
ALTER TABLE `groups`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `group_members`
--
ALTER TABLE `group_members`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `messages`
--
ALTER TABLE `messages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `calls`
--
ALTER TABLE `calls`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=53;

--
-- AUTO_INCREMENT for table `call_participants`
--
ALTER TABLE `call_participants`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=84;

--
-- AUTO_INCREMENT for table `groups`
--
ALTER TABLE `groups`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=30;

--
-- AUTO_INCREMENT for table `group_members`
--
ALTER TABLE `group_members`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=97;

--
-- AUTO_INCREMENT for table `messages`
--
ALTER TABLE `messages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=67;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
