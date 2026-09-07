char	*ft_itoa(int n)
{
	char	*str;
	long	num;
	int		len;

	num = n;
	len = ft_numlen(num);
	str = malloc(len + 1);
	if (!str)
	{
		return (NULL);
	}
	str[len] = '\0';
	if (num < 0)
	{
		str[0] = '-';
		num = -num;
	}
	while (len--)
	{
		str[len] = (num % 10) + '0';
		num /= 10;
		if (num == 0 && len > 0 && str[0] == '-')
			break;
	}
	return (str);
}
