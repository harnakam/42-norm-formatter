/* ************************************************************************** */
/*                                                                            */
/*                                                       :::      ::::::::    */
/*   custom_type_header.h                              :+:      :+:    :+:    */
/*                                                   +:+ +:+         +:+      */
/*   By: username <username@student.42tokyo.jp>    #+#  +:+       +#+         */
/*                                               +#+#+#+#+#+   +#+            */
/*   Created: 2026/03/13 08:02:18 by username         #+#    #+#              */
/*   Updated: 2026/03/13 08:02:18 by username        ###   ########.fr        */
/*                                                                            */
/* ************************************************************************** */

#ifndef CUSTOM_TYPE_HEADER_H
# define CUSTOM_TYPE_HEADER_H

# include <stdio.h>

typedef struct s_user
{
	int		id;
	char	*name;
}	t_user;

t_user	*find_user_by_id(t_user *users, FILE *stream, int id);

#endif
